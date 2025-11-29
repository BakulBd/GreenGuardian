import AdminExamClient from "./AdminExamClient";

export async function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function AdminExamPage() {
  return <AdminExamClient />;
}
