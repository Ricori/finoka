import type { StorageLocation } from "../bridge/storage.ts";

/**
 * 运行环境页在下载开始前那张「安装位置」卡的显隐与语气。
 *
 * 抽成纯函数是因为这里的状态转换比看上去绕：选完位置的那一刻 `custom` 变真、
 * 提示条件立刻变假，但卡片上还挂着用户刚才那次点击对应的「开始安装」，不能跟着
 * 一起消失。
 */
export interface InstallLocationView {
  /** 点「一键准备全部」这类大安装时，是否要先停下来问位置。 */
  prompt: boolean;
  /** 卡片本身是否显示。 */
  visible: boolean;
  /** 目标盘装不下建议体量，转成警告态。 */
  tight: boolean;
  /** 已经挑好了别的盘，只差按开始。 */
  settled: boolean;
}

const hidden: InstallLocationView = { prompt: false, visible: false, tight: false, settled: false };

export function installLocationView(location: StorageLocation | null | undefined, awaitingInstall: boolean): InstallLocationView {
  if (!location) return hidden;
  const tight = !location.enoughSpace;
  // 只在还没装的时候提示：那是改位置唯一免费的时刻，目录里没有东西要搬。
  // 已经自己选过位置的人不再打扰，除非那块盘根本装不下。
  const prompt = location.empty && (!location.custom || tight);
  return {
    prompt,
    visible: prompt || awaitingInstall,
    tight,
    settled: location.custom && !tight,
  };
}
