/**
 * The people who built GreenGuardian, rendered by the "Meet the Developers"
 * section on the landing page (`components/home/DevelopersSection.tsx`).
 *
 * Kept as plain data so the section never has to be edited to change a person:
 * drop a photo into `public/developers/` and point `image` at it, or fill in a
 * `linkedin` once someone has a profile.
 *
 * `image: null` is a supported state, not a placeholder to be filled with a
 * stock photo — the card falls back to a monogram in the person's own accent
 * colour. `linkedin: null` is likewise deliberate: the card still shows the
 * LinkedIn mark, disabled and labelled "coming soon", rather than linking
 * somewhere invented.
 */

export interface Developer {
  /** Stable key; also used for the card's element ids. */
  id: string;
  name: string;
  role: string;
  /** Path under `public/`, e.g. "/developers/bakul.jpg". `null` → monogram. */
  image: string | null;
  email: string;
  github: string;
  /** `null` until the person actually has a profile to link to. */
  linkedin: string | null;
  /**
   * Which accent the card draws itself in. A NAME, not Tailwind classes:
   * Tailwind only scans `app/` and `components/` (tailwind.config.ts), so class
   * strings written in this file would be purged from the stylesheet and the
   * gradients would silently render as nothing. The names map to classes in
   * `components/home/DevelopersSection.tsx`, the same way the landing page's
   * other cards already handle colour.
   */
  accent: DeveloperAccent;
}

export type DeveloperAccent = "emerald" | "teal" | "lime";

/** Initials shown when a developer has no photo yet. */
export function initialsOf(name: string): string {
  const words = name
    // "Md." / "Mst." are honorifics, not given names — a monogram built from
    // them would read the same for two different people.
    .replace(/\b(md|mst|mr|mrs|ms)\.?\s+/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export const DEVELOPERS: Developer[] = [
  {
    id: "bakul-ahmed",
    name: "Bakul Ahmed",
    role: "Full-Stack & Platform",
    image: null,
    email: "cyberbokul@gmail.com",
    github: "https://github.com/BakulBd",
    linkedin: null,
    accent: "emerald",
  },
  {
    id: "sajjad-mahmud-suton",
    name: "Md. Sajjad Mahmud Suton",
    role: "Backend & Proctoring",
    image: null,
    email: "sajjadmahmudsuton@gmail.com",
    github: "https://github.com/Sajjad-Mahmud-Suton",
    linkedin: "https://www.linkedin.com/in/md-sajjad-mahmud-suton-344a802a7/",
    accent: "teal",
  },
  {
    id: "esha-akter",
    name: "Mst. Esha Akter",
    role: "Frontend & Experience",
    image: null,
    email: "mstesha981@gmail.com",
    github: "https://github.com/Esha-Akter",
    linkedin: null,
    accent: "lime",
  },
];
