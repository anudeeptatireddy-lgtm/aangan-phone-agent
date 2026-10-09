import { redirect } from "next/navigation";

// The site's front page is the dashboard (it has its own password / open-demo rules).
export default function Home() {
  redirect("/dashboard");
}
