import Link from "next/link";

export default function NotFound(): React.ReactElement {
  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-24 text-center lg:px-12">
      <div className="font-mono text-7xl font-black text-acid">404</div>
      <p className="mt-4 text-sm text-fog">This route does not exist on the gateway or the console.</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-xl border border-acid bg-acid px-5 py-2.5 text-sm font-bold text-black"
      >
        Back to overview
      </Link>
    </div>
  );
}
