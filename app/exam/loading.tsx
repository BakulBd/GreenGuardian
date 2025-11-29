import { Loader2 } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";

export default function ExamLoading() {
  return (
    <DashboardLayout role="student">
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-green-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading exams...</p>
        </div>
      </div>
    </DashboardLayout>
  );
}
