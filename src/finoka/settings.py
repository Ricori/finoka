"""FineSub-native local settings, exposed without revealing secret values."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import tomllib
from typing import Any, Mapping
from urllib.parse import urlsplit

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

BASE_URL_SPECS: tuple[dict[str, str], ...] = (
    {
        "name": "GEMINI_BASE_URL",
        "label": "Gemini",
        "defaultValue": "https://generativelanguage.googleapis.com/v1beta",
    },
    {
        "name": "OPENAI_BASE_URL",
        "label": "OpenAI",
        "defaultValue": "https://api.openai.com/v1",
    },
    {
        "name": "ANTHROPIC_BASE_URL",
        "label": "Anthropic",
        "defaultValue": "https://api.anthropic.com",
    },
)
BASE_URL_NAMES = frozenset(spec["name"] for spec in BASE_URL_SPECS)
SETTING_NAMES = KEY_NAMES | BASE_URL_NAMES

MODEL_PROVIDERS = frozenset({"gemini-free", "gemini-paid", "openai", "anthropic"})
MODEL_ROUTE_SPECS: tuple[dict[str, str], ...] = (
    {"id": "correction", "label": "纠错与翻译"},
    {"id": "planning", "label": "窗口规划"},
    {"id": "research", "label": "资料研究"},
    {"id": "search_judge", "label": "检索判断"},
    {"id": "knowledge", "label": "知识处理"},
)
MODEL_SETTING_NAMES = frozenset(
    {"LLM_DEFAULT_PROVIDER", "LLM_DEFAULT_MODEL"}
    | {
        f"LLM_ROUTE_{spec['id'].upper()}_{field}"
        for spec in MODEL_ROUTE_SPECS
        for field in ("PROVIDER", "MODEL")
    }
)
SETTING_NAMES = SETTING_NAMES | MODEL_SETTING_NAMES

_MODEL_SETTING_TO_CONFIG = {
    "LLM_DEFAULT_PROVIDER": "default_provider",
    "LLM_DEFAULT_MODEL": "default_model",
    **{
        f"LLM_ROUTE_{spec['id'].upper()}_{field.upper()}": f"{spec['id']}_{field}"
        for spec in MODEL_ROUTE_SPECS
        for field in ("provider", "model")
    },
}

_MODEL_CATALOG_HEADER = (
    "fact_id|provider_tier|provider_kind|base_url|key_env|display_name|"
    "api_model_id|max_input_tokens|max_output_tokens|supports_audio|"
    "supports_video|supports_native_search|thinking|quality_score"
)


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


def _read_toml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    with path.open("rb") as handle:
        data = tomllib.load(handle)
    return data if isinstance(data, dict) else {}


def _builtin_model_options() -> dict[str, list[dict[str, Any]]]:
    from finesub.llm.routing.model_catalog import default_model_catalog

    tiers = {"GEMINI_FREE": "gemini-free", "GEMINI_PAID": "gemini-paid"}
    result: dict[str, list[dict[str, Any]]] = {provider: [] for provider in MODEL_PROVIDERS}
    for entry in default_model_catalog():
        provider = tiers.get(entry.provider_tier)
        if provider is None or entry.self_reported:
            continue
        result[provider].append(
            {
                "id": entry.api_model_id,
                "label": entry.display_name,
                "supportsAudio": entry.supports_audio,
                "supportsVideo": entry.supports_video,
            }
        )
    return result


def _route_from_config(config: Mapping[str, Any], prefix: str) -> dict[str, str]:
    provider = str(config.get(f"{prefix}_provider") or "").strip()
    model = str(config.get(f"{prefix}_model") or "").strip()
    return {"provider": provider, "model": model}


class FineSubSettings:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.env_file = self.root / "finesub.env"
        self.config_file = self.root / "finesub.toml"
        self.model_catalog_file = self.root / "model_catalog.psv"

    def bind_environment(self) -> None:
        os.environ["FINESUB_ENV_FILE"] = str(self.env_file)
        os.environ["FINESUB_CONFIG_FILE"] = str(self.config_file)
        os.environ["FINESUB_MODEL_CATALOG"] = str(self.model_catalog_file)
        os.environ["FINESUB_CHECKOUT_DATA"] = "0"
        os.environ.setdefault("FINESUB_KNOWLEDGE_ROOT", str(self.root / "knowledge"))
        os.environ.setdefault("FINESUB_STATE_DIR", str(self.root / "state"))

    def snapshot(self) -> dict[str, Any]:
        secrets = _secrets_module()
        values = secrets.read_env_file(self.env_file)
        states = secrets.env_status(self.env_file)
        config = _read_toml(self.config_file)
        model_config = config.get("finoka_models", {})
        if not isinstance(model_config, Mapping):
            model_config = {}
        model_options = _builtin_model_options()
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
            "baseUrls": [
                {
                    **spec,
                    "value": values.get(spec["name"], "").strip().rstrip("/"),
                    "customized": bool(values.get(spec["name"], "").strip()),
                }
                for spec in BASE_URL_SPECS
            ],
            "modelRouting": {
                "providers": [
                    {"id": "gemini-free", "label": "Gemini", "mode": "select", "models": model_options["gemini-free"]},
                    {"id": "gemini-paid", "label": "Gemini 付费池", "mode": "select", "models": model_options["gemini-paid"]},
                    {"id": "openai", "label": "OpenAI", "mode": "input", "models": []},
                    {"id": "anthropic", "label": "Anthropic", "mode": "input", "models": []},
                ],
                "defaultRoute": _route_from_config(model_config, "default"),
                "taskRoutes": [
                    {**spec, "route": _route_from_config(model_config, spec["id"])}
                    for spec in MODEL_ROUTE_SPECS
                ],
            },
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
        unknown = sorted(set(updates) - SETTING_NAMES)
        if unknown:
            raise ValueError(f"Unknown FineSub key setting(s): {', '.join(unknown)}")
        normalized: dict[str, str | None] = {}
        model_updates: dict[str, str | None] = {}
        for name, value in updates.items():
            if value is None:
                if name in MODEL_SETTING_NAMES:
                    model_updates[_MODEL_SETTING_TO_CONFIG[name]] = None
                else:
                    normalized[name] = None
                continue
            if not isinstance(value, str):
                raise ValueError(f"{name} must be a string or null")
            cleaned = value.strip()
            if name in MODEL_SETTING_NAMES:
                if len(cleaned) > 256 or "|" in cleaned or any(character.isspace() for character in cleaned):
                    raise ValueError(f"{name} must be a model/provider identifier of at most 256 characters")
                model_updates[_MODEL_SETTING_TO_CONFIG[name]] = cleaned or None
                continue
            if name in BASE_URL_NAMES and cleaned:
                if len(cleaned) > 2_048:
                    raise ValueError(f"{name} exceeds the 2048 character limit")
                if "|" in cleaned:
                    raise ValueError(f"{name} contains an unsupported character")
                parsed = urlsplit(cleaned)
                if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                    raise ValueError(f"{name} must be an http(s) URL")
                if parsed.username or parsed.password or parsed.query or parsed.fragment:
                    raise ValueError(
                        f"{name} must not contain credentials, a query, or a fragment"
                    )
                cleaned = cleaned.rstrip("/")
            elif len(cleaned) > 32_768:
                raise ValueError(f"{name} exceeds the 32768 character limit")
            normalized[name] = cleaned or None
        if normalized:
            secrets.update_env_file(self.env_file, normalized)
        if model_updates:
            self._update_model_routing(model_updates)
        self._sync_model_routing(secrets.read_env_file(self.env_file))
        try:
            self.env_file.chmod(0o600)
        except OSError:
            # Windows protects values with DPAPI; POSIX additionally narrows
            # the fallback plaintext file to the current account.
            pass
        return self.snapshot()

    def _update_model_routing(self, updates: Mapping[str, str | None]) -> None:
        from finesub_bootstrap.config_file import update_config_file

        current = _read_toml(self.config_file).get("finoka_models", {})
        if not isinstance(current, Mapping):
            current = {}
        candidate = {**current, **updates}
        options = _builtin_model_options()
        allowed_gemini = {
            provider: {item["id"] for item in models}
            for provider, models in options.items()
            if provider.startswith("gemini-")
        }
        for prefix in ("default", *(spec["id"] for spec in MODEL_ROUTE_SPECS)):
            route = _route_from_config(candidate, prefix)
            provider, model = route["provider"], route["model"]
            if not provider and not model:
                continue
            if provider not in MODEL_PROVIDERS:
                raise ValueError(f"Unknown LLM provider for {prefix}: {provider or '(empty)'}")
            if not model:
                raise ValueError(f"A model is required for LLM route {prefix}")
            if provider.startswith("gemini-") and model not in allowed_gemini[provider]:
                raise ValueError(f"Model {model!r} is not available in {provider}")
        update_config_file(self.config_file, {"finoka_models": updates})

    @staticmethod
    def _custom_target(provider: str, model: str) -> str:
        digest = hashlib.sha256(f"{provider}\0{model}".encode("utf-8")).hexdigest()[:12]
        return f"finoka-{provider}-{digest}"

    def _sync_model_routing(self, env_values: Mapping[str, str]) -> None:
        from finesub_bootstrap.config_file import update_config_file
        from finesub_bootstrap.fsops import write_atomic

        data = _read_toml(self.config_file)
        model_config = data.get("finoka_models", {})
        if not isinstance(model_config, Mapping):
            model_config = {}
        options = _builtin_model_options()
        gemini_targets = {
            "gemini-free": {item["id"]: f"gemini-free-{item['id'].split('/')[-1].replace('.', '_')}" for item in options["gemini-free"]},
            "gemini-paid": {item["id"]: f"gemini-paid-{item['id'].split('/')[-1].replace('.', '_')}" for item in options["gemini-paid"]},
        }
        # Catalog fact IDs are authoritative; derive the Gemini target map from
        # the packaged entries instead of relying on display/model spelling.
        from finesub.llm.routing.model_catalog import default_model_catalog
        for entry in default_model_catalog():
            provider = {"GEMINI_FREE": "gemini-free", "GEMINI_PAID": "gemini-paid"}.get(entry.provider_tier)
            if provider and not entry.self_reported:
                gemini_targets[provider][entry.api_model_id] = entry.fact_id

        routes = {
            "default": _route_from_config(model_config, "default"),
            **{spec["id"]: _route_from_config(model_config, spec["id"]) for spec in MODEL_ROUTE_SPECS},
        }
        custom_models = sorted(
            {
                (route["provider"], route["model"])
                for route in routes.values()
                if route["provider"] in {"openai", "anthropic"} and route["model"]
            }
        )
        default_urls = {spec["name"]: spec["defaultValue"] for spec in BASE_URL_SPECS}
        catalog_lines = [_MODEL_CATALOG_HEADER]
        for provider, model in custom_models:
            target = self._custom_target(provider, model)
            if provider == "openai":
                kind, tier, key_env, url_name = "openai_compat", "FINOKA_OPENAI", "OPENAI_API_KEY", "OPENAI_BASE_URL"
            else:
                kind, tier, key_env, url_name = "anthropic", "FINOKA_ANTHROPIC", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"
            base_url = (env_values.get(url_name) or default_urls[url_name]).strip().rstrip("/")
            catalog_lines.append(
                "|".join(
                    [target, tier, kind, base_url, key_env, model, model, "128000", "16384", "false", "false", "false", "true", "70"]
                )
            )
        write_atomic(self.model_catalog_file, "\n".join(catalog_lines) + "\n", newline="")

        def target_for(route: Mapping[str, str]) -> str | None:
            provider, model = route.get("provider", ""), route.get("model", "")
            if not provider or not model:
                return None
            if provider in gemini_targets:
                return gemini_targets[provider].get(model)
            if provider in {"openai", "anthropic"}:
                return self._custom_target(provider, model)
            return None

        update_config_file(
            self.config_file,
            {
                "llm": {
                    "default_target": target_for(routes["default"]),
                    **{
                        f"task_route_{spec['id']}": target_for(routes[spec["id"]])
                        for spec in MODEL_ROUTE_SPECS
                    },
                },
            },
        )
        try:
            from finesub.config import clear_config_cache
            from finesub.llm.routing.model_catalog import default_model_catalog

            clear_config_cache()
            default_model_catalog.cache_clear()
        except ImportError:
            pass
