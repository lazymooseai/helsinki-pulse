import { DashboardProvider } from "@/context/DashboardContext";
import DashboardHeader from "@/components/DashboardHeader";
import HslTicker from "@/components/HslTicker";
import CommandCenter from "@/components/CommandCenter";
import JackpotAlert from "@/components/JackpotAlert";
import CapacityFeeds from "@/components/CapacityFeeds";
import DetailTabs from "@/components/DetailTabs";
import TrafficCameras from "@/components/TrafficCameras";
import FeedbackButtons from "@/components/FeedbackButtons";
import ScanButton from "@/components/ScanButton";
import DevTools from "@/components/DevTools";
import TripHistoryCard from "@/components/trips/TripHistoryCard";
import TripsTabs from "@/components/trips/TripsTabs";

const Index = () => {
  return (
    <DashboardProvider>
      <div className="min-h-screen bg-background pb-28">
        <DashboardHeader />
        <HslTicker />
        <CommandCenter />
        <FeedbackButtons />
        <JackpotAlert />
        <CapacityFeeds />
        <DetailTabs />
        <TrafficCameras />
        <TripHistoryCard />
        <TripsTabs />
        <ScanButton />
        <DevTools />
      </div>
    </DashboardProvider>
  );
};

export default Index;
