import AdminExamEditClient from "./AdminExamEditClient";

export async function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function AdminExamEditPage() {
  return <AdminExamEditClient />;
}
