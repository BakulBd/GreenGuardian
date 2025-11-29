// This file provides static params for dynamic exam routes
// Since exams are dynamic, we return a placeholder and rely on client-side rendering

export function generateStaticParams() {
  // Return placeholder for static export - actual content is loaded client-side
  return [{ id: 'placeholder' }];
}

export default function ExamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
