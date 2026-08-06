import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface StudentPdfRow {
  name: string;
  studentCode?: string;
  email: string;
  department?: string;
  semester?: string;
  phone?: string;
  assignedTeacher?: string;
  registrationDate?: string;
  status?: string;
}

/**
 * Generates and downloads a formatted PDF roster of students — Feature 2.
 * No university logo asset exists in this project (public/ doesn't have
 * one), so the header falls back to a text wordmark, matching the "if
 * available" qualifier in the spec.
 */
export function downloadStudentInfoPdf(students: StudentPdfRow[], title = "Student Information Report"): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const generatedAt = new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const drawHeader = () => {
    doc.setFillColor(22, 163, 74); // emerald-600
    doc.rect(0, 0, pageWidth, 56, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("GreenGuardian", 32, 26);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("AI-Powered Exam Security Platform", 32, 40);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(title, pageWidth - 32, 26, { align: "right" });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated ${generatedAt}`, pageWidth - 32, 40, { align: "right" });
    doc.setTextColor(0, 0, 0);
  };

  drawHeader();

  autoTable(doc, {
    startY: 70,
    head: [["#", "Name", "Student ID", "Email", "Department", "Semester", "Phone", "Assigned Teacher", "Registered", "Status"]],
    body: students.map((s, idx) => [
      String(idx + 1),
      s.name || "N/A",
      s.studentCode || "N/A",
      s.email || "N/A",
      s.department || "N/A",
      s.semester || "N/A",
      s.phone || "N/A",
      s.assignedTeacher || "Unassigned",
      s.registrationDate || "N/A",
      s.status || "Active",
    ]),
    theme: "grid",
    headStyles: { fillColor: [22, 101, 52], textColor: 255, fontStyle: "bold", fontSize: 8.5 },
    bodyStyles: { fontSize: 8, cellPadding: 5 },
    alternateRowStyles: { fillColor: [240, 253, 244] },
    margin: { top: 70, left: 24, right: 24 },
    didDrawPage: (data) => {
      // Re-draw the header on every page (autoTable calls this per page break).
      if (data.pageNumber > 1) drawHeader();

      // Footer: page number, drawn after the table so it works across pages.
      const pageCount = (doc as any).internal.getNumberOfPages();
      const pageNumber = data.pageNumber;
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth / 2, pageHeight - 20, { align: "center" });
      doc.text("GreenGuardian — Confidential Student Record", 24, pageHeight - 20);
      doc.setTextColor(0, 0, 0);
    },
  });

  const filename = `student-report-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
