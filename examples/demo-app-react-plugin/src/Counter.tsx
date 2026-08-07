import { useState } from "react";
import MemoBadge from "./MemoBadge";

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>count is {count}</button>
      <MemoBadge label="demo" />
    </div>
  );
}
