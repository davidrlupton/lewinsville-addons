// The privacy page Google's OAuth consent screen links to. Plain words, no tracking, nothing to click.
export const metadata = { title: "Privacy · Lewinsville" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-xl px-5 py-10 text-[16px] leading-relaxed">
      <h1 className="display text-3xl font-extrabold">Privacy</h1>
      <p className="mt-1 text-sm text-ink-soft">The house at 7703 Lewinsville Road. Updated 8 November 2026.</p>

      <h2 className="mt-8 text-lg font-bold">What this is</h2>
      <p className="mt-2">lewinsville.vip is a private app for one household. It shows and controls the lights, shades, heating and
      cooling, music and energy of a single family home. It is not offered to the public.</p>

      <h2 className="mt-6 text-lg font-bold">What we collect</h2>
      <p className="mt-2">When you sign in with Google, we receive your email address and name. That is all we ask Google for,
      and we use it only to recognise you and decide what you may see and do. The app keeps a log of what was asked of
      the house and what it did, with the name of the person who asked, so the household can see its own history. The
      log lives on a computer inside the house.</p>

      <h2 className="mt-6 text-lg font-bold">What we never do</h2>
      <p className="mt-2">We do not sell, share or advertise with anything about you. There are no analytics or tracking scripts.
      Nothing leaves the house except what is needed to run the home: cloud services the devices themselves require, and the
      assistant that answers your questions.</p>

      <h2 className="mt-6 text-lg font-bold">Who to ask</h2>
      <p className="mt-2">The household, at <a className="underline" href="mailto:7703lewinsville@gmail.com">7703lewinsville@gmail.com</a>.
      Ask and your sign-in and anything logged under your name will be removed.</p>
    </main>
  );
}
