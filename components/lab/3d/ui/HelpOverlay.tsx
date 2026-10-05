"use client";

import { Button } from "@/components/ui/button";
import { useLabUi } from "../../lab-state-provider";

/**
 * Optional help (§26).
 *
 * Help explains and points; it never performs. Every topic either describes
 * where a piece of apparatus is or how a reading works, and "Show me" only asks
 * the scene to put the camera on the apparatus (and, where relevant, opens the
 * guide ring). Nothing here sends a protocol action, so a student cannot use
 * help to skip the practical.
 */
interface HelpTopic {
  id: string;
  question: string;
  answer: string;
  /** Camera/guide target, or null for pure text. */
  focus: "burette" | "flask" | "balance" | "cylinder" | null;
}

const TOPICS: HelpTopic[] = [
  {
    id: "find-burette",
    question: "Where can I find the burette?",
    answer:
      "It rests in its cradle at the left of the bench. Pick it up with E and lower it onto the clamp on the stand; only a clamped burette can be filled.",
    focus: "burette",
  },
  {
    id: "read-meniscus",
    question: "How do I read the burette?",
    answer:
      "Stand the camera level with the liquid surface and read the bottom of the curved meniscus against the scale, to the declared precision. Record the number yourself — the laboratory never fills it in for you.",
    focus: "burette",
  },
  {
    id: "stopcock",
    question: "How do I control the flow?",
    answer:
      "Grab the stopcock handle and turn it. A small turn is a slow drip for the approach to the endpoint; a large turn runs the titrant in fast. Close it fully to stop the flow before you read.",
    focus: "burette",
  },
  {
    id: "weigh",
    question: "Where do I weigh the standard?",
    answer:
      "The analytical balance is on the right. Stand the dry beaker on the pan, read the mass, lift it off to add the standard, then set it back and read again — the sample mass is the difference.",
    focus: "balance",
  },
  {
    id: "cylinder",
    question: "Where is the measuring cylinder?",
    answer:
      "It stands near the middle of the bench. Pour the solution into it up to the mark, transfer it into the flask, then record the volume you actually delivered.",
    focus: "cylinder",
  },
  {
    id: "flask-position",
    question: "Where should the flask be for titration?",
    answer:
      "Set the flask on the white tile so its mouth sits under the burette tip. Titrate there, swirling continuously, then take the final reading.",
    focus: "flask",
  },
  {
    id: "overshoot",
    question: "What should I do if I overshoot?",
    answer:
      "Complete the trial as it is and record what you saw. An overshot trial is rejected rather than hidden; pour the flask into the waste container and run another trial. Nothing tells you the right endpoint — judge it from the colour.",
    focus: "flask",
  },
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const { requestFocus } = useLabUi();

  return (
    <div
      className="pointer-events-auto absolute right-2 top-20 z-30 w-80 max-w-[85vw] rounded-lg border border-line bg-surface/95 p-3 shadow-xl backdrop-blur"
      role="dialog"
      aria-label="Help"
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">Need help?</p>
        <Button size="sm" variant="ghost" className="ms-auto h-6 px-2 text-[11px]" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="mt-0.5 text-[11px] text-muted">
        Help explains and points. It will not perform a step for you.
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {TOPICS.map((topic) => (
          <li key={topic.id} className="rounded border border-line px-2 py-1.5 text-xs">
            <div className="flex items-start gap-2">
              <span className="font-medium leading-snug">{topic.question}</span>
              {topic.focus ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="ms-auto h-6 shrink-0 px-2 text-[11px]"
                  onClick={() => {
                    requestFocus(topic.focus);
                    onClose();
                  }}
                >
                  Show me
                </Button>
              ) : null}
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">{topic.answer}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
