import { selectTasks, tasks } from "./tasks";

const search = document.querySelector<HTMLInputElement>("#search");
const count = document.querySelector<HTMLOutputElement>("#result-count");
if (!search || !count) throw new Error("Board controls are missing");

function render() {
  const visible = selectTasks(tasks, search!.value);
  const ids = new Set(visible.map((task) => task.id));
  for (const task of tasks) {
    const card = document.getElementById(task.id);
    if (card) card.hidden = !ids.has(task.id);
  }
  count!.textContent = `${visible.length} of ${tasks.length} tasks`;
}

search.disabled = false;
search.addEventListener("input", render);
render();
