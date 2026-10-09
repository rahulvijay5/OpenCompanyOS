import Link from "next/link";

export function AppNav() {
  return (
    <div className="topnav">
      <Link className="brand" href="/">
        OpenCompanyOS
      </Link>
      <nav>
        <Link href="/app">Workspace</Link>
        <Link href="/">Home</Link>
      </nav>
    </div>
  );
}
