import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from dataclasses import dataclass
from typing import Optional


MODEL_CONFIGS = {
    "1B": {
        "n_layers": 16, "d_model": 2048, "n_heads": 16, "n_kv_heads": 8,
        "ffn_mult": 2.667, "vocab_size": 32000, "max_seq_len": 2048,
        "tie_embeddings": True,
    },
    "7B": {
        "n_layers": 32, "d_model": 4096, "n_heads": 32, "n_kv_heads": 8,
        "ffn_mult": 2.667, "vocab_size": 32000, "max_seq_len": 4096,
        "tie_embeddings": False,
    },
    "30B": {
        "n_layers": 60, "d_model": 6656, "n_heads": 52, "n_kv_heads": 8,
        "ffn_mult": 2.667, "vocab_size": 32000, "max_seq_len": 4096,
        "tie_embeddings": False,
    },
    "400B": {
        "n_layers": 126, "d_model": 16384, "n_heads": 128, "n_kv_heads": 8,
        "ffn_mult": 1.333, "vocab_size": 32000, "max_seq_len": 8192,
        "tie_embeddings": False,
    },
}

VRAM_TABLE = {
    "1B":   {"params": "~1.1B", "bf16_weights": "~2.2 GB",  "training_vram": "~14 GB",   "min_gpu": "RTX 3080 10GB (w/ grad ckpt)"},
    "7B":   {"params": "~6.7B", "bf16_weights": "~13.4 GB", "training_vram": "~80 GB",   "min_gpu": "2× A100 80GB or 4× RTX 4090"},
    "30B":  {"params": "~30B",  "bf16_weights": "~60 GB",   "training_vram": "~360 GB",  "min_gpu": "8× A100 80GB"},
    "400B": {"params": "~405B", "bf16_weights": "~810 GB",  "training_vram": "~4.8 TB",  "min_gpu": "64× A100 80GB"},
}


@dataclass
class ModelConfig:
    n_layers: int
    d_model: int
    n_heads: int
    n_kv_heads: int
    ffn_mult: float
    vocab_size: int
    max_seq_len: int
    tie_embeddings: bool = False

    @classmethod
    def from_size(cls, size: str) -> "ModelConfig":
        return cls(**MODEL_CONFIGS[size])

    @property
    def head_dim(self) -> int:
        return self.d_model // self.n_heads

    @property
    def ffn_hidden(self) -> int:
        # SwiGLU: round to multiple of 256 for efficiency
        raw = int(self.d_model * self.ffn_mult)
        return (raw + 255) // 256 * 256


class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        norm = x.float().pow(2).mean(-1, keepdim=True).add(self.eps).rsqrt()
        return (x.float() * norm).to(x.dtype) * self.weight


def precompute_rope_freqs(head_dim: int, max_seq_len: int, base: float = 10000.0) -> torch.Tensor:
    theta = 1.0 / (base ** (torch.arange(0, head_dim, 2).float() / head_dim))
    positions = torch.arange(max_seq_len).float()
    freqs = torch.outer(positions, theta)
    return torch.polar(torch.ones_like(freqs), freqs)  # complex64


def apply_rope(x: torch.Tensor, freqs: torch.Tensor) -> torch.Tensor:
    # x: (B, T, n_heads, head_dim)
    T = x.shape[1]
    x_c = torch.view_as_complex(x.float().reshape(*x.shape[:-1], -1, 2))
    freqs_c = freqs[:T].unsqueeze(0).unsqueeze(2)  # (1, T, 1, head_dim//2)
    x_rotated = torch.view_as_real(x_c * freqs_c).flatten(-2)
    return x_rotated.to(x.dtype)


class GroupedQueryAttention(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.n_heads = config.n_heads
        self.n_kv_heads = config.n_kv_heads
        self.head_dim = config.head_dim
        self.n_rep = config.n_heads // config.n_kv_heads

        self.q_proj = nn.Linear(config.d_model, config.n_heads * config.head_dim, bias=False)
        self.k_proj = nn.Linear(config.d_model, config.n_kv_heads * config.head_dim, bias=False)
        self.v_proj = nn.Linear(config.d_model, config.n_kv_heads * config.head_dim, bias=False)
        self.o_proj = nn.Linear(config.n_heads * config.head_dim, config.d_model, bias=False)

    def forward(self, x: torch.Tensor, freqs: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        B, T, _ = x.shape
        q = self.q_proj(x).view(B, T, self.n_heads, self.head_dim)
        k = self.k_proj(x).view(B, T, self.n_kv_heads, self.head_dim)
        v = self.v_proj(x).view(B, T, self.n_kv_heads, self.head_dim)

        q = apply_rope(q, freqs)
        k = apply_rope(k, freqs)

        # Expand k/v for GQA
        k = k.repeat_interleave(self.n_rep, dim=2)
        v = v.repeat_interleave(self.n_rep, dim=2)

        # (B, n_heads, T, head_dim)
        q = q.transpose(1, 2)
        k = k.transpose(1, 2)
        v = v.transpose(1, 2)

        out = F.scaled_dot_product_attention(q, k, v, attn_mask=mask, is_causal=(mask is None))
        out = out.transpose(1, 2).contiguous().view(B, T, -1)
        return self.o_proj(out)


class SwiGLUFFN(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.gate_proj = nn.Linear(config.d_model, config.ffn_hidden, bias=False)
        self.up_proj   = nn.Linear(config.d_model, config.ffn_hidden, bias=False)
        self.down_proj = nn.Linear(config.ffn_hidden, config.d_model, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down_proj(F.silu(self.gate_proj(x)) * self.up_proj(x))


class TransformerBlock(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.attn_norm = RMSNorm(config.d_model)
        self.attn = GroupedQueryAttention(config)
        self.ffn_norm = RMSNorm(config.d_model)
        self.ffn = SwiGLUFFN(config)

    def forward(self, x: torch.Tensor, freqs: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.attn_norm(x), freqs)
        x = x + self.ffn(self.ffn_norm(x))
        return x


class RoseGPT(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.embed = nn.Embedding(config.vocab_size, config.d_model)
        self.layers = nn.ModuleList([TransformerBlock(config) for _ in range(config.n_layers)])
        self.norm = RMSNorm(config.d_model)
        self.lm_head = nn.Linear(config.d_model, config.vocab_size, bias=False)

        if config.tie_embeddings:
            self.lm_head.weight = self.embed.weight

        self.register_buffer(
            "rope_freqs",
            precompute_rope_freqs(config.head_dim, config.max_seq_len),
            persistent=False,
        )

        self.apply(self._init_weights)

    def _init_weights(self, module: nn.Module):
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def forward(self, tokens: torch.Tensor, targets: Optional[torch.Tensor] = None):
        B, T = tokens.shape
        x = self.embed(tokens)
        for layer in self.layers:
            x = layer(x, self.rope_freqs)
        x = self.norm(x)
        logits = self.lm_head(x)

        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.view(-1, self.config.vocab_size), targets.view(-1), ignore_index=-1)
        return logits, loss

    @torch.no_grad()
    def generate(self, tokens: torch.Tensor, max_new_tokens: int, temperature: float = 0.8, top_p: float = 0.9) -> torch.Tensor:
        for _ in range(max_new_tokens):
            ctx = tokens[:, -self.config.max_seq_len:]
            logits, _ = self(ctx)
            logits = logits[:, -1, :] / temperature

            # top-p sampling
            probs = F.softmax(logits, dim=-1)
            sorted_probs, sorted_idx = torch.sort(probs, descending=True)
            cumulative = torch.cumsum(sorted_probs, dim=-1)
            mask = (cumulative - sorted_probs) > top_p
            sorted_probs[mask] = 0.0
            sorted_probs /= sorted_probs.sum(dim=-1, keepdim=True)
            next_token = sorted_idx[torch.multinomial(sorted_probs, 1)]
            tokens = torch.cat([tokens, next_token], dim=-1)
        return tokens

    def param_count(self) -> int:
        return sum(p.numel() for p in self.parameters())
