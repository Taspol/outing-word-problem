import type { CSSProperties } from "react";
import { hintSlots } from "@/lib/text";

/**
 * Shows a pattern such as "เ _ี ย _" as evenly spaced letters and underlined blanks, with any vowel or tone mark
 * typed after a blank drawn above or below it, where it would sit on a real letter.
 *
 * A blank is a bar about one Thai letter wide. Thai marks are drawn to hang over the letter before them, so
 * marks placed right after the bar land on the blank, at the height they would have on a real letter.
 */
export default function HintText({ hint, className = "", style }: { hint: string; className?: string; style?: CSSProperties }) {
  return (
    <span role="img" aria-label={hint} style={style} className={`inline-flex items-baseline gap-[.2em] whitespace-nowrap ${className}`}>
      {hintSlots(hint).map((s, i) => {
        if (s.base !== "_") return <span key={i} aria-hidden="true">{s.base + s.marks}</span>;
        // ำ is a circle over this letter plus า after it; split it so the circle lands on the blank.
        const marks = s.marks.replace("ำ", "ํา");
        return (
          <span key={i} aria-hidden="true" className="inline-flex items-baseline">
            {/* a bar one letter wide, just under the baseline (vertical-align moves it relative to the baseline) */}
            <span className="inline-block h-[.09em] w-[.62em] bg-current align-[-.2em]" />
            {marks && <span>{marks}</span>}
          </span>
        );
      })}
    </span>
  );
}
