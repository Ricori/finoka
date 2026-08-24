"""FineSub-native local settings, exposed without revealing secret values."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping

KEY_SPECS: tuple[dict[str, str], ...] = (
    {"name": "GEMINI_FREE", "label": "Gemini 免费池", "purpose": "LLM 纠错、翻译与 Gemma 搜索"},
    {"name": "GEMINI_PAID", "label": "Gemini 付费池", "purpose": "质量优先的纠错与翻译"},
    {"name": "EXA_KEYS", "label": "Exa", "purpose": "联网检索"},
    {"name": "TAVILY_KEYS", "label": "Tavily", "purpose": "联网检索回退"},
    {"name": "ANTHROPIC_API_KEY", "label": "Anthropic", "purpose": "本地代理高级配置"},
    {"name": "OPENAI_API_KEY", "label": "OpenAI", "purpose": "本地代理高级配置"},
    {"name": "HF_TOKEN", "label": "Hugging Face", "purpose": "受限模型下载"},
)
KEY_NAMES = frozenset(spec["name"] for spec in KEY_SPECS)


def _entries(value: str) -> list[tuple[str, str]]:
    cleaned = value.strip()
    if cleaned.startswith("{") and cleaned.endswith("}"):
        cleaned = cleaned[1:-1]
    if not cleaned:
        return []
    parts = [part.strip() for part in cleaned.split(",") if part.strip()]
    mapped: list[tuple[str, str]] = []
    for part in parts:
        if ":" not in part:
            mapped = []
            break
        label, key = part.split(":", 1)
        label = label.strip().strip("\"'")
        key = key.strip().strip("\"'")
        if label and key:
            mapped.append((label, key))
    if mapped and len(mapped) == len(parts):
        return mapped
    return [("", part.strip("\"'")) for part in parts if part.strip("\"'")]


def _secrets_module():
    from finesub_bootstrap import secrets

    return secrets


class FineSubSettings:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.env_file = self.root / "finesub.env"
        self.config_file = self.root / "finesub.toml"

    def bind_environment(self) -> None:
        os.environ["FINESUB_ENV_FILE"] = str(self.env_file)
        os.environ["FINESUB_CONFIG_FILE"] = str(self.config_file)
        os.environ["FINESUB_CHECKOUT_DATA"] = "0"
        os.environ.setdefault("FINESUB_KNOWLEDGE_ROOT", str(self.root / "knowledge"))
        os.environ.setdefault("FINESUB_STATE_DIR", str(self.root / "state"))

    def snapshot(self) -> dict[str, Any]:
        secrets = _secrets_module()
        values = secrets.read_env_file(self.env_file)
        states = secrets.env_status(self.env_file)
        keys: list[dict[str, Any]] = []
        for spec in KEY_SPECS:
            name = spec["name"]
            entries = _entries(values.get(name, ""))
            keys.append(
                {
                    **spec,
                    "configured": bool(entries),
                    "count": len(entries),
                    "masked": [
                        {"name": label, "value": secrets.masked(key)}
                        for label, key in entries
                    ],
                    "storage": states.get(name, "missing"),
                }
            )
        configured_states = [item["storage"] for item in keys if item["configured"]]
        if not configured_states:
            protection = "empty"
        elif all(state == "protected" for state in configured_states):
            protection = "protected"
        elif any(state == "unreadable" for state in configured_states):
            protection = "unreadable"
        else:
            protection = "plaintext"
        return {
            "schema": 1,
            "keys": keys,
            "llmKeyConfigured": any(
                item["configured"] and item["name"] in {"GEMINI_FREE", "GEMINI_PAID", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"}
                for item in keys
            ),
            "retrievalKeyConfigured": any(
                item["configured"] and item["name"] in {"EXA_KEYS", "TAVILY_KEYS", "GEMINI_FREE"}
                for item in keys
            ),
            "protection": protection,
        }

    def update_keys(self, updates: Mapping[str, Any]) -> dict[str, Any]:
        secrets = _secrets_module()
        unknown = sorted(set(updates) - KEY_NAMES)
        if unknown:
            raise ValueError(f"Unknown FineSub key setting(s): {', '.join(unknown)}")
        normalized: dict[str, str | None] = {}
        for name, value in updates.items():
            if value is None:
                normalized[name] = None
                continue
            if not isinstance(value, str):
                raise ValueError(f"{name} must be a string or null")
            cleaned = value.strip()
            if len(cleaned) > 32_768:
                raise ValueError(f"{name} exceeds the 32768 character limit")
            normalized[name] = cleaned or None
        secrets.update_env_file(self.env_file, normalized)
        try:
            self.env_file.chmod(0o600)
        except OSError:
            # Windows protects values with DPAPI; POSIX additionally narrows
            # the fallback plaintext file to the current account.
            pass
        return self.snapshot()
