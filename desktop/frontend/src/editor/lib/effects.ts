import {
  EFFECT_TEMPLATE_MAP, defaultEffectParams, effectBindingKey, isGeneratorTemplate,
  normalizeEffectParams, targetsOverlap,
} from '../../subtitles/effects.ts';
import { bumpDoc, docStore } from '../store/docStore';
import { markDirty } from '../store/saveStore';
import { toast } from '../store/uiStore';
import type { SubtitleEffectBinding, SubtitleEffectParam, SubtitleEffectTarget } from '../types';
import { syncSubs } from './subtitles';

const refresh = () => { bumpDoc(); syncSubs(); markDirty(); };

export function exactEffectBinding(templateId: string, target: SubtitleEffectTarget): SubtitleEffectBinding | null {
  const key = effectBindingKey(templateId, target);
  return docStore.get().effects.find(binding => effectBindingKey(binding.templateId, binding.target) === key) ?? null;
}

/**
 * 一条 lane 上只能有一个生成型模板：它们都把整句拆成逐字事件，叠加只会互相盖住。
 * 勾上新的就把会落到同一条 lane 上的旧生成型绑定摘掉，并说一声摘的是哪个——
 * 悄悄消失一个绑定比拦着不让勾更难查。
 */
function evictConflictingGenerators(templateId: string, target: SubtitleEffectTarget) {
  if (!isGeneratorTemplate(templateId)) return;
  const effects = docStore.get().effects;
  const dropped: string[] = [];
  for (let index = effects.length - 1; index >= 0; index--) {
    const other = effects[index];
    if (other.templateId === templateId) continue;
    if (!isGeneratorTemplate(other.templateId)) continue;
    if (!targetsOverlap(other.target, target)) continue;
    dropped.unshift(EFFECT_TEMPLATE_MAP[other.templateId]?.name || other.templateId);
    effects.splice(index, 1);
  }
  if (dropped.length) toast(`同一条轨只能用一个生成型特效，已移除「${[...new Set(dropped)].join("、")}」`);
}

export function enableEffect(templateId: string, target: SubtitleEffectTarget): SubtitleEffectBinding {
  evictConflictingGenerators(templateId, target);
  const existing = exactEffectBinding(templateId, target);
  if (existing) {
    existing.enabled = true;
    refresh();
    return existing;
  }
  const binding: SubtitleEffectBinding = {
    id: `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    templateId,
    enabled: true,
    target,
    params: defaultEffectParams(templateId),
  };
  docStore.get().effects.push(binding);
  refresh();
  return binding;
}

export function disableEffect(templateId: string, target: SubtitleEffectTarget) {
  const effects = docStore.get().effects;
  const key = effectBindingKey(templateId, target);
  const index = effects.findIndex(binding => effectBindingKey(binding.templateId, binding.target) === key);
  if (index < 0) return;
  effects.splice(index, 1);
  refresh();
}

export function updateEffectParams(templateId: string, target: SubtitleEffectTarget,
  patch: Record<string, SubtitleEffectParam>) {
  const binding = exactEffectBinding(templateId, target) ?? enableEffect(templateId, target);
  binding.params = normalizeEffectParams(templateId, { ...binding.params, ...patch });
  refresh();
}

export function removeEffectsForTrack(trackId: string) {
  const d = docStore.get();
  d.effects = d.effects.filter(binding =>
    binding.target.scope === "all" || binding.target.trackId !== trackId);
}
