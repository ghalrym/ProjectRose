"""Runtime configuration.

New shape: a flat pool of named *configs* (each one = provider_type + model +
whatever settings that provider needs), plus a role→config_name mapping.

    {
      "configs": {
        "<name>": {"provider_type": "...", "model": "...", "base_url": "...", "api_key": "..."},
        ...
      },
      "roles": {"chat": "<name>", "embedding": "<name>", ...},
      "embedding_model_used_for_index": "..."
    }

This lets users create as many OpenAI-compatible configs as they like (one
named "Groq", another "Together", another "LM Studio", …) and assign any of
them to any role.
"""
from __future__ import annotations

import json
import os
import re
import threading
from typing import Any

CONFIG_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "config.json")
)

ROLES = ("chat", "embedding", "compression", "skill_router")

PROVIDER_TYPES = ("ollama", "openai", "anthropic", "openai_compatible")

# Fields each provider_type expects. Anything outside this set is stripped.
PROVIDER_FIELDS: dict[str, tuple[str, ...]] = {
    "ollama":            ("model", "base_url"),
    "openai":            ("model", "api_key"),
    "anthropic":         ("model", "api_key"),
    "openai_compatible": ("model", "base_url", "api_key"),
}

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\- ]{0,62}[A-Za-z0-9]$|^[A-Za-z0-9]$")

DEFAULT_OLLAMA_URL = "http://host.docker.internal:11434"

DEFAULT_CONFIG: dict[str, Any] = {
    "configs": {
        "ollama-glm-4.7-flash": {
            "provider_type": "ollama",
            "model": "glm-4.7-flash",
            "base_url": DEFAULT_OLLAMA_URL,
        },
        "ollama-nomic-embed-text": {
            "provider_type": "ollama",
            "model": "nomic-embed-text",
            "base_url": DEFAULT_OLLAMA_URL,
        },
    },
    "roles": {
        "chat":         "ollama-glm-4.7-flash",
        "embedding":    "ollama-nomic-embed-text",
        "compression":  "ollama-glm-4.7-flash",
        "skill_router": "ollama-glm-4.7-flash",
    },
    "embedding_model_used_for_index": "",
}

_lock = threading.Lock()
_cache: dict[str, Any] | None = None


# ---------- Normalization & migration ----------


def _normalize_config(entry: dict[str, Any]) -> dict[str, Any] | None:
    """Return a sanitized config entry, or None if it's not valid."""
    if not isinstance(entry, dict):
        return None
    ptype = str(entry.get("provider_type") or "").strip()
    if ptype not in PROVIDER_TYPES:
        return None
    out: dict[str, Any] = {"provider_type": ptype}
    for field in PROVIDER_FIELDS[ptype]:
        val = entry.get(field, "")
        out[field] = "" if val is None else str(val)
    return out


def _migrate_old_shape(raw: dict[str, Any]) -> dict[str, Any] | None:
    """If `raw` is the pre-refactor shape (providers+roles-as-objects), convert
    it to the new shape. Returns None if `raw` doesn't look like the old shape.
    """
    if "configs" in raw:
        return None
    if "providers" not in raw or "roles" not in raw:
        return None
    old_providers = raw.get("providers", {}) or {}
    old_roles = raw.get("roles", {}) or {}
    if not all(isinstance(v, dict) and "provider" in v for v in old_roles.values()):
        return None

    configs: dict[str, dict[str, Any]] = {}
    new_roles: dict[str, str] = {}
    for role_name in ROLES:
        r = old_roles.get(role_name) or {}
        old_provider = r.get("provider") or "ollama"
        model = r.get("model") or ""
        ptype = "openai_compatible" if old_provider == "custom_openai" else old_provider
        if ptype not in PROVIDER_TYPES:
            ptype = "ollama"
        prov_settings = old_providers.get(old_provider, {}) or {}
        cfg_name = f"{ptype}-{model or role_name}".strip("-") or role_name
        # de-dupe name across roles
        if cfg_name in configs and configs[cfg_name]["model"] != model:
            cfg_name = f"{cfg_name}-{role_name}"
        entry: dict[str, Any] = {"provider_type": ptype, "model": model}
        if ptype == "ollama":
            entry["base_url"] = prov_settings.get("base_url") or DEFAULT_OLLAMA_URL
        elif ptype in ("openai", "anthropic"):
            entry["api_key"] = prov_settings.get("api_key") or ""
        elif ptype == "openai_compatible":
            entry["base_url"] = prov_settings.get("base_url") or ""
            entry["api_key"] = prov_settings.get("api_key") or ""
        configs[cfg_name] = entry
        new_roles[role_name] = cfg_name

    return {
        "configs": configs,
        "roles": new_roles,
        "embedding_model_used_for_index": raw.get("embedding_model_used_for_index", ""),
    }


def _merge_defaults(cfg: dict[str, Any]) -> dict[str, Any]:
    """Sanitize + fill in missing pieces from DEFAULT_CONFIG."""
    migrated = _migrate_old_shape(cfg)
    if migrated is not None:
        cfg = migrated

    out: dict[str, Any] = {
        "configs": {},
        "roles": {},
        "embedding_model_used_for_index": cfg.get("embedding_model_used_for_index", ""),
    }

    # Configs: sanitize each. If nothing valid, seed defaults.
    raw_configs = cfg.get("configs") or {}
    for name, entry in raw_configs.items():
        if not validate_config_name(name):
            continue
        norm = _normalize_config(entry)
        if norm is not None:
            out["configs"][name] = norm

    if not out["configs"]:
        out["configs"] = json.loads(json.dumps(DEFAULT_CONFIG["configs"]))

    # Roles: every role must point to an existing config. Fall back to defaults.
    raw_roles = cfg.get("roles") or {}
    first_config = next(iter(out["configs"]))
    for role in ROLES:
        assigned = raw_roles.get(role)
        if isinstance(assigned, str) and assigned in out["configs"]:
            out["roles"][role] = assigned
        else:
            default_for_role = DEFAULT_CONFIG["roles"].get(role)
            if default_for_role in out["configs"]:
                out["roles"][role] = default_for_role
            else:
                out["roles"][role] = first_config

    return out


# ---------- Persistence ----------


def load() -> dict[str, Any]:
    global _cache
    with _lock:
        if _cache is not None:
            return _cache
        if os.path.isfile(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
            merged = _merge_defaults(raw)
            if merged != raw:
                _write_locked(merged)
            _cache = merged
        else:
            _cache = json.loads(json.dumps(DEFAULT_CONFIG))
            _write_locked(_cache)
        return _cache


def save(cfg: dict[str, Any]) -> None:
    global _cache
    with _lock:
        merged = _merge_defaults(cfg)
        _write_locked(merged)
        _cache = merged


def _write_locked(cfg: dict[str, Any]) -> None:
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, CONFIG_PATH)


def reload() -> dict[str, Any]:
    global _cache
    with _lock:
        _cache = None
    return load()


# ---------- Typed accessors ----------


def validate_config_name(name: str) -> bool:
    return bool(isinstance(name, str) and _NAME_RE.match(name))


def list_configs() -> dict[str, dict[str, Any]]:
    return dict(load()["configs"])


def get_config(name: str) -> dict[str, Any] | None:
    return load()["configs"].get(name)


def create_config(name: str, provider_type: str, fields: dict[str, Any]) -> None:
    if not validate_config_name(name):
        raise ValueError(
            "Name must be 1–64 chars of letters, digits, space, dot, underscore, or hyphen."
        )
    if provider_type not in PROVIDER_TYPES:
        raise ValueError(f"Unknown provider_type: {provider_type}")
    cfg = load()
    if name in cfg["configs"]:
        raise ValueError(f"Config already exists: {name}")
    entry = _normalize_config({"provider_type": provider_type, **fields})
    if entry is None:
        raise ValueError("Invalid config fields")
    cfg["configs"][name] = entry
    save(cfg)


def update_config(name: str, provider_type: str, fields: dict[str, Any]) -> None:
    cfg = load()
    if name not in cfg["configs"]:
        raise KeyError(name)
    if provider_type not in PROVIDER_TYPES:
        raise ValueError(f"Unknown provider_type: {provider_type}")
    entry = _normalize_config({"provider_type": provider_type, **fields})
    if entry is None:
        raise ValueError("Invalid config fields")
    cfg["configs"][name] = entry
    save(cfg)


def delete_config(name: str) -> None:
    cfg = load()
    if name not in cfg["configs"]:
        return
    if len(cfg["configs"]) <= 1:
        raise ValueError("Cannot delete the last config — create another one first.")
    # If any role points at this config, redirect them to the first surviving config.
    del cfg["configs"][name]
    replacement = next(iter(cfg["configs"]))
    for role, assigned in list(cfg["roles"].items()):
        if assigned == name:
            cfg["roles"][role] = replacement
    save(cfg)


def get_role_config_name(role: str) -> str:
    return load()["roles"].get(role, "")


def get_role_config(role: str) -> dict[str, Any] | None:
    cfg = load()
    name = cfg["roles"].get(role)
    if not name:
        return None
    return cfg["configs"].get(name)


def set_role_config_name(role: str, config_name: str) -> None:
    if role not in ROLES:
        raise ValueError(f"Unknown role: {role}")
    cfg = load()
    if config_name not in cfg["configs"]:
        raise ValueError(f"Unknown config: {config_name}")
    cfg["roles"][role] = config_name
    save(cfg)


def set_embedding_watermark(model: str) -> None:
    cfg = load()
    cfg["embedding_model_used_for_index"] = model
    save(cfg)
