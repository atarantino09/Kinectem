import VideoWithControls from "@/components/video/VideoWithControls";
import CaptureHarness from "@/components/video/CaptureHarness";

export default function App() {
  const isCapture =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("capture");
  return isCapture ? <CaptureHarness /> : <VideoWithControls />;
}
