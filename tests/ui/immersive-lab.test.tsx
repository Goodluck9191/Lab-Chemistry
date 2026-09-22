// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { labStateViewFor } from "../helpers/lab-fixture";
import { renderLabWorld } from "../helpers/lab-render";
import { freshSession } from "../helpers/titration-fixtures";

// The controller imports the server actions at module scope; component tests
// inject their own sender, so the real ones must never be loaded here.
vi.mock("@/application/attempts/actions", () => ({
  submitLabActionAction: vi.fn(),
  getLabStateAction: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanup);

/**
 * The immersive shell: the laboratory route renders the 3D world directly, with
 * a four-corner HUD over it and nothing permanent in between. Everything else —
 * the contextual prompt, the drawers — is transient and keyboard-reachable.
 */
describe("immersive laboratory shell (jsdom)", () => {
  it("renders the 3D world with a minimal HUD and no 2D lab", async () => {
    const user = userEvent.setup();
    const state = labStateViewFor(freshSession("immersive-shell"));
    renderLabWorld({ state });

    expect(screen.getByLabelText(/immersive 3d laboratory/i)).toBeTruthy();
    expect(screen.getByText(/experiment 2/i)).toBeTruthy();
    expect(screen.getByRole("status", { name: /current objective/i })).toBeTruthy();
    expect(screen.getByRole("status", { name: /trial progress/i })).toBeTruthy();
    expect(screen.getByText(/wasd walk/i)).toBeTruthy();
    expect(screen.getByText(/autosaved/i)).toBeTruthy();

    // No 2D lab in the student experience: no view tabs, no permanent panels.
    expect(screen.queryByRole("tab", { name: /2d bench/i })).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    // The pointer is never captured silently.
    expect(screen.getByText(/click the laboratory to look around/i)).toBeTruthy();

    // Drawers open on demand and host the same panels.
    await user.click(screen.getByRole("button", { name: /^procedure$/i }));
    expect(screen.getByRole("complementary", { name: "Procedure" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(screen.getAllByText(/prepare the working solution/i).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /^results$/i }));
    expect(screen.getByRole("dialog", { name: /results and data/i })).toBeTruthy();
  });

  it("opens and closes the contextual prompt from the keyboard", async () => {
    const user = userEvent.setup();
    const state = labStateViewFor(freshSession("immersive-keys"));
    renderLabWorld({ state });

    expect(screen.queryByRole("dialog", { name: /contextual interaction prompt/i })).toBeNull();

    // E opens the prompt for whatever is in reach.
    await user.keyboard("{e}");
    const prompt = screen.getByRole("dialog", { name: /contextual interaction prompt/i });
    expect(prompt).toBeTruthy();
    expect(screen.getByLabelText("3D contextual actions")).toBeTruthy();

    // Esc steps back out, innermost surface first.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /contextual interaction prompt/i })).toBeNull();

    // F with nothing selected focuses nothing but never crashes.
    await user.keyboard("{f}");
    expect(screen.getByLabelText(/immersive 3d laboratory/i)).toBeTruthy();
  });

  it("offers the apparatus and the reagent shelf in the prompt", async () => {
    const user = userEvent.setup();
    const state = labStateViewFor(freshSession("immersive-select"));
    renderLabWorld({ state });
    await user.keyboard("{e}");

    for (const label of ["Burette", "Flask", "Balance", "Beaker", "Cylinder", "Reagents"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    // Picking one repoints the prompt at it.
    await user.click(screen.getByRole("button", { name: "Burette" }));
    const prompt = screen.getByRole("dialog", { name: /contextual interaction prompt/i });
    expect(prompt.textContent).toMatch(/burette, 50 ml/i);
    // The prompt advertises the keys it can act on.
    expect(prompt.textContent).toMatch(/interact/i);
  });

  it("picks a vessel up and sets it down with the keyboard", async () => {
    const user = userEvent.setup();
    const state = labStateViewFor(freshSession("immersive-carry"));
    renderLabWorld({ state });

    // Selecting the flask from the prompt is how the keyboard reaches it.
    await user.keyboard("{e}");
    await user.click(screen.getByRole("button", { name: "Flask" }));
    await user.click(screen.getByRole("button", { name: /pick the flask up/i }));

    // In hand: the HUD says so, and the held vessel can be turned.
    const holding = screen.getByRole("status", { name: /holding/i });
    expect(holding.textContent).toMatch(/erlenmeyer flask/i);
    expect(holding.textContent).toMatch(/0°/);
    // R turns it by a visible step: 15° per press.
    await user.keyboard("{r}");
    expect(screen.getByRole("status", { name: /holding/i }).textContent).toMatch(/15°/);
    await user.keyboard("{r}");
    expect(screen.getByRole("status", { name: /holding/i }).textContent).toMatch(/30°/);

    // Space puts it down.
    await user.keyboard(" ");
    expect(screen.queryByRole("status", { name: /holding/i })).toBeNull();
  });
});
