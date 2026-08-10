import MeetingClient from "./MeetingClient";

// Mirrors app/exam/[id]: a placeholder keeps `output: export` builds happy,
// and the real meeting code is read from the route on the client.
export async function generateStaticParams() {
  return [{ code: "placeholder" }];
}

export default function GreenRoomMeetingPage() {
  return <MeetingClient />;
}
