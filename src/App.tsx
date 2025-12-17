import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { SettingsPage } from "./components/settings";
import { ApiServerPage } from "./components/api-server/ApiServerPage";
import { ProviderPoolPage } from "./components/provider-pool";
import { RoutingManagementPage } from "./components/routing/RoutingManagementPage";
import { ConfigManagementPage } from "./components/config/ConfigManagementPage";
import { ExtensionsPage } from "./components/extensions";

type Page =
  | "dashboard"
  | "provider-pool"
  | "routing-management"
  | "config-management"
  | "extensions"
  | "api-server"
  | "settings";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard />;
      case "provider-pool":
        return <ProviderPoolPage />;
      case "routing-management":
        return <RoutingManagementPage />;
      case "config-management":
        return <ConfigManagementPage />;
      case "extensions":
        return <ExtensionsPage />;
      case "api-server":
        return <ApiServerPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="flex-1 overflow-auto p-6">{renderPage()}</main>
    </div>
  );
}

export default App;
