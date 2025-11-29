import ExamClient from "./ExamClient";

// Generate static params for production build (output: export)
// In development, this is ignored and pages are rendered dynamically
export async function generateStaticParams() {
  // Return a placeholder for static export - actual content is loaded client-side
  return [{ id: 'placeholder' }];
}

export default function ExamPage() {
  return <ExamClient />;
}
