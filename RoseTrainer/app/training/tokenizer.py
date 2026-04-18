import os
import json
from pathlib import Path
from tokenizers import ByteLevelBPETokenizer
from tokenizers import Tokenizer

SPECIAL_TOKENS = ["<|endoftext|>", "<|thinking|>", "<|/thinking|>", "<|im_start|>", "<|im_end|>"]
VOCAB_SIZE = 32000


def train_tokenizer(texts: list[str], save_dir: str | Path, vocab_size: int = VOCAB_SIZE) -> Tokenizer:
    save_dir = Path(save_dir)
    save_dir.mkdir(parents=True, exist_ok=True)

    tmp_corpus = save_dir / "_corpus.txt"
    tmp_corpus.write_text("\n".join(texts), encoding="utf-8")

    tokenizer = ByteLevelBPETokenizer()
    tokenizer.train(
        files=[str(tmp_corpus)],
        vocab_size=vocab_size,
        min_frequency=2,
        special_tokens=SPECIAL_TOKENS,
    )
    tokenizer.save_model(str(save_dir))
    tmp_corpus.unlink(missing_ok=True)

    meta = {
        "special_tokens": SPECIAL_TOKENS,
        "vocab_size": vocab_size,
        "eot_id": tokenizer.token_to_id("<|endoftext|>"),
        "thinking_start_id": tokenizer.token_to_id("<|thinking|>"),
        "thinking_end_id": tokenizer.token_to_id("<|/thinking|>"),
    }
    (save_dir / "tokenizer_meta.json").write_text(json.dumps(meta, indent=2))
    return tokenizer


def load_tokenizer(tokenizer_dir: str | Path) -> ByteLevelBPETokenizer:
    tokenizer_dir = Path(tokenizer_dir)
    vocab_file = tokenizer_dir / "vocab.json"
    merges_file = tokenizer_dir / "merges.txt"
    tokenizer = ByteLevelBPETokenizer(str(vocab_file), str(merges_file))
    tokenizer.add_special_tokens(SPECIAL_TOKENS)
    return tokenizer


def get_eot_id(tokenizer_dir: str | Path) -> int:
    meta_path = Path(tokenizer_dir) / "tokenizer_meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        return meta["eot_id"]
    # fallback: query tokenizer
    tok = load_tokenizer(tokenizer_dir)
    return tok.token_to_id("<|endoftext|>")
