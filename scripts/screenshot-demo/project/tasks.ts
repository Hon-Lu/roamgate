export type Status = "todo" | "active" | "done";

export type Task = {
  id: string;
  title: string;
  status: Status;
};

export const tasks: readonly Task[] = [
  { id: "N-101", title: "Update navigation labels", status: "todo" },
  { id: "N-102", title: "Add status filter", status: "active" },
  { id: "N-103", title: "Review empty state", status: "todo" },
  { id: "N-104", title: "Check keyboard navigation", status: "active" },
  { id: "N-105", title: "Polish board spacing", status: "done" },
  { id: "N-106", title: "Document local preview", status: "done" },
];

export function selectTasks(items: readonly Task[], query: string): Task[] {
  const normalized = query.trim().toLowerCase();
  return items.filter((task) => task.title.toLowerCase().includes(normalized));
}
