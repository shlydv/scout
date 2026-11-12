import { redirect } from "next/navigation";

/** Stacks were replaced by goal shelves, which live on the home page. */
export default function StacksPage() {
  redirect("/#shelves");
}
