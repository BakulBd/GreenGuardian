import TeacherExamEditClient from "./TeacherExamEditClient";

export async function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function TeacherExamEditPage() {
  return <TeacherExamEditClient />;
}
