import { notFound } from "next/navigation";
import { MonadV2DashboardShell } from "@/components/monad-v2/monad-v2-dashboard";

export default async function SpaceV2DashboardPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;
  if (spaceSlug !== "monad") notFound();
  return <MonadV2DashboardShell />;
}
