import TeacherExamClient from "./TeacherExamClient";

export async function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function TeacherExamPage() {
  return <TeacherExamClient />;
}
