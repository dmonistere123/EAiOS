const res = await fetch('http://localhost:5200/api/kanban');
const data = await res.json();
const t = data.tasks.find((x) => x.id === 't_8d98ede4');
console.log(JSON.stringify(t, null, 2));