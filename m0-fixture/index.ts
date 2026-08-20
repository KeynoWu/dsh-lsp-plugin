function greet(name: string): string {
  return `hello ${name}`;
}

const user = "world";
const msg = greet(user);
console.log(msg);
