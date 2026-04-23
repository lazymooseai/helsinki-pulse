import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TripsImport from "./TripsImport";
import TripsManualForm from "./TripsManualForm";
import TripsHistory from "./TripsHistory";

const TripsTabs = () => {
  return (
    <div className="px-4 py-3">
      <Tabs defaultValue="history" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="history">Historia</TabsTrigger>
          <TabsTrigger value="add">Lisää</TabsTrigger>
          <TabsTrigger value="import">Tuonti</TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="mt-4"><TripsHistory /></TabsContent>
        <TabsContent value="add" className="mt-4"><TripsManualForm /></TabsContent>
        <TabsContent value="import" className="mt-4"><TripsImport /></TabsContent>
      </Tabs>
    </div>
  );
};

export default TripsTabs;