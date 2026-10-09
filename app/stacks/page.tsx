import { redirect } from "next/navigation";

/** Stacks were replaced by goal shelves. */
export default function StacksPage() {
  redirect("/shelves");
}
