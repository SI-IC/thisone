export default function DemoHeader({ active }: { active: "vue" | "react" }) {
  return (
    <header className="demo-header">
      <nav>
        <a href="/" className={active === "vue" ? "active" : undefined}>
          Vue
        </a>
        <a
          href="/react-demo/"
          className={active === "react" ? "active" : undefined}
        >
          React
        </a>
      </nav>
    </header>
  );
}
