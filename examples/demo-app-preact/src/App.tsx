import Counter from "./Counter";
import DemoHeader from "./DemoHeader";
import "./app.css";

export default function App() {
  return (
    <>
      <DemoHeader active="preact" />
      <main>
        <h1>thisone preact demo</h1>
        <Counter />
      </main>
    </>
  );
}
