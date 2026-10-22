import type { Metadata } from "next";
import Monitor from "@/components/Monitor";

export const metadata: Metadata = { title: "Outing Word Monitor" };

export default async function MonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Monitor id={id.toUpperCase()} />;
}
