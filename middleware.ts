import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // This is a placeholder middleware
  // In a real app, you'd check the user's authentication status and role
  // For now, we'll just allow all requests
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/exam/:path*",
  ],
};
