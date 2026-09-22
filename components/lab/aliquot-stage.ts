/**
 * Progress of the guided aliquot transfer (measure into the ware, then deliver
 * into the flask).
 *
 * UI-ONLY, like the rest of `LabUiContext`: it moves the drawing and gates the
 * guided panel steps, but the volume the server records is always the reading
 * the student enters. Lives here — not in a presentation component — so the
 * provider does not have to depend on the view layer.
 */
export type AliquotStage = "resting" | "measured" | "delivered";
