import Counter from "./Counter";
import DemoHeader from "./DemoHeader";
import "./app.css";

export default function App() {
  return (
    <>
      <DemoHeader active="react" />
      <main>
        <h1>thisone react demo</h1>
        <Counter />
      </main>
    </>
  );
}
