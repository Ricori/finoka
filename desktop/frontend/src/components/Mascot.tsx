import { useState } from "react";

/** Which pose an empty state asks for: waiting for an import, found nothing,
    or nothing has been run yet. */
export type MascotPose = "welcome" | "idle" | "wave";

const fallbackGlyph: Record<MascotPose, string> = {
  welcome: "🎬",
  idle: "🔎",
  wave: "✨",
};

type MascotProps = {
  pose: MascotPose;
};

/** The art ships in public/assets rather than the bundle, so a packaging slip
    would leave the empty state without a picture. Fall back to a glyph and keep
    the surrounding copy intact instead of rendering a broken image. */
export function Mascot({ pose }: MascotProps) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="mascot-stage" aria-hidden="true">
      {failed ? (
        <span className="mascot-fallback">{fallbackGlyph[pose]}</span>
      ) : (
        <img className="mascot" src={`./assets/mascot-${pose}.png`} alt="" onError={() => setFailed(true)} />
      )}
    </span>
  );
}
