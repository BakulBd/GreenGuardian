"use client";

/**
 * "Meet the Developers" — the landing-page section introducing the team,
 * rendered directly below "Designed for Everyone" in `app/page.tsx`.
 *
 * The people themselves live in `lib/data/developers.ts`; this file only knows
 * how to draw a card. Two states are handled deliberately rather than papered
 * over:
 *
 *   - no photo yet  → a monogram in the person's accent colour, never a stock
 *     portrait of somebody unrelated;
 *   - no LinkedIn yet → the mark is still shown, but disabled and announced as
 *     "coming soon" instead of pointing at a guessed URL.
 *
 * The `id="developers"` anchor is what the navbar's Developers link scrolls to;
 * `scroll-mt-24` keeps the heading clear of the fixed header.
 */

import { motion } from "framer-motion";
import { Github, Linkedin, Mail, Code2 } from "lucide-react";
import { DEVELOPERS, initialsOf, type Developer, type DeveloperAccent } from "@/lib/data/developers";

/**
 * Accent name → Tailwind classes.
 *
 * Written out in full (never composed from fragments) because Tailwind matches
 * complete class strings in the source; `from-${name}-500` produces no CSS.
 */
const ACCENTS: Record<DeveloperAccent, { gradient: string; ring: string }> = {
  emerald: { gradient: "from-emerald-500 to-green-600", ring: "ring-emerald-200" },
  teal: { gradient: "from-teal-500 to-emerald-600", ring: "ring-teal-200" },
  lime: { gradient: "from-lime-500 to-emerald-600", ring: "ring-lime-200" },
};

export default function DevelopersSection() {
  return (
    <section
      id="developers"
      aria-labelledby="developers-heading"
      className="scroll-mt-24 py-12 sm:py-16 md:py-24 bg-white relative overflow-hidden"
    >
      {/* Background decoration — purely presentational. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-emerald-100/50 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-80 h-80 bg-teal-100/40 rounded-full blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgb(16 185 129) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8 sm:mb-12 md:mb-16"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-100 rounded-full text-green-700 text-xs font-medium mb-3 sm:mb-4">
            <Code2 className="h-3.5 w-3.5" />
            <span>The Team</span>
          </div>
          <h2
            id="developers-heading"
            className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-gray-900 mb-2 sm:mb-3"
          >
            Meet the Developers
          </h2>
          <p className="text-sm sm:text-base text-gray-600 max-w-xl mx-auto">
            The people who designed, built, and maintain GreenGuardian
          </p>
        </motion.div>

        <div className="grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
          {DEVELOPERS.map((developer, index) => (
            <DeveloperCard key={developer.id} developer={developer} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DeveloperCard({ developer, index }: { developer: Developer; index: number }) {
  const { name, role, image, email, github, linkedin } = developer;
  const accent = ACCENTS[developer.accent] ?? ACCENTS.emerald;

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay: index * 0.12, ease: "easeOut" }}
      whileHover={{ y: -6 }}
      className="group relative h-full"
    >
      {/* Gradient hairline border: a 1px padded wrapper around a solid card. */}
      <div
        className={`h-full rounded-2xl bg-gradient-to-br ${accent.gradient} p-[1.5px] shadow-lg shadow-gray-200/60 transition-shadow duration-300 group-hover:shadow-xl group-hover:shadow-emerald-200/60`}
      >
        <div className="h-full rounded-[14.5px] bg-white/95 backdrop-blur-sm px-5 sm:px-6 pt-8 pb-6 flex flex-col items-center text-center">
          <div className="relative mb-4 sm:mb-5">
            <div
              aria-hidden="true"
              className={`absolute -inset-1.5 rounded-full bg-gradient-to-br ${accent.gradient} opacity-15 blur-md transition-opacity duration-300 group-hover:opacity-40`}
            />
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element -- images are
              // unoptimized project-wide (next.config.js) and this avatar is a
              // fixed-size local asset.
              <img
                src={image}
                alt={`Portrait of ${name}`}
                width={112}
                height={112}
                loading="lazy"
                className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover ring-4 ${accent.ring} bg-gray-100`}
              />
            ) : (
              <div
                role="img"
                aria-label={`Monogram avatar for ${name}`}
                className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-full ring-4 ${accent.ring} bg-gradient-to-br ${accent.gradient} flex items-center justify-center text-white text-2xl sm:text-3xl font-bold tracking-wide select-none`}
              >
                {initialsOf(name)}
              </div>
            )}
          </div>

          <h3 className="text-base sm:text-lg font-semibold text-gray-900 leading-snug text-balance">
            {name}
          </h3>
          <p className="mt-1 text-xs sm:text-sm text-gray-500">{role}</p>

          <div className="mt-auto pt-5 sm:pt-6 flex items-center justify-center gap-2.5">
            <SocialLink
              href={github}
              label={`${name} on GitHub`}
              className="hover:bg-gray-900 hover:text-white hover:border-gray-900"
            >
              <Github className="h-4 w-4" />
            </SocialLink>

            <SocialLink
              href={`mailto:${email}`}
              label={`Email ${name} at ${email}`}
              external={false}
              className="hover:bg-red-500 hover:text-white hover:border-red-500"
            >
              <Mail className="h-4 w-4" />
            </SocialLink>

            {linkedin ? (
              <SocialLink
                href={linkedin}
                label={`${name} on LinkedIn`}
                className="hover:bg-[#0a66c2] hover:text-white hover:border-[#0a66c2]"
              >
                <Linkedin className="h-4 w-4" />
              </SocialLink>
            ) : (
              <span
                aria-disabled="true"
                title="LinkedIn profile coming soon"
                className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-dashed border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed"
              >
                <Linkedin className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">
                  LinkedIn profile for {name} is coming soon
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function SocialLink({
  href,
  label,
  children,
  className,
  external = true,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  className?: string;
  /** `mailto:` links must not get `target="_blank"` — it opens a blank tab. */
  external?: boolean;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 bg-white text-gray-600 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${className ?? ""}`}
    >
      <span aria-hidden="true" className="contents">
        {children}
      </span>
    </a>
  );
}
