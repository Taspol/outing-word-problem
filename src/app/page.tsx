import { readProblems } from "@/lib/store";
import App from "@/components/App";

export const dynamic = "force-dynamic";

export default async function Page() {
  const problems = await readProblems();
  return <App initialProblems={problems} />;
}
