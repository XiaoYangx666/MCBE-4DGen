import { useEffect, useState } from "react";
import { AboutDialog } from "./ui/AboutDialog";
import { AppBar } from "./ui/AppBar";
import { LibraryPage } from "./pages/LibraryPage";
import { PackPage } from "./pages/PackPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { WebNav } from "./ui/WebNav";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { useHashRoute } from "./lib/use-hash-route";
import { useWorkbench } from "./workbench/use-workbench";

export function App() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const workbench = useWorkbench();
  const { page } = useHashRoute();

  useEffect(() => {
    return window.desktop?.onAbout(() => setAboutOpen(true));
  }, []);

  useEffect(() => {
    const blockFileDrop = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files"))
        event.preventDefault();
    };
    window.addEventListener("dragover", blockFileDrop);
    window.addEventListener("drop", blockFileDrop);
    return () => {
      window.removeEventListener("dragover", blockFileDrop);
      window.removeEventListener("drop", blockFileDrop);
    };
  }, []);

  const saveButton =
    page === "workbench" && workbench.session?.modelId ? (
      <button
        disabled={workbench.busy}
        onClick={() => void workbench.saveSettings()}
      >
        {workbench.dirty ? "保存配置 ●" : "配置已保存"}
      </button>
    ) : null;
  const navigation = window.desktop ? (
    <AppBar page={page}>{saveButton}</AppBar>
  ) : (
    <WebNav
      page={page}
      modelName={workbench.session?.name}
      action={saveButton}
    />
  );

  if (page !== "workbench")
    return (
      <div className="app">
        {navigation}
        {page === "settings" ? (
          <SettingsPage onAbout={() => setAboutOpen(true)} />
        ) : page === "packs" ? (
          <PackPage />
        ) : page === "templates" ? (
          <TemplatesPage />
        ) : (
          <LibraryPage
            key={page}
            onOpen={(loaded, settings) => {
              if (workbench.busy) return;
              if (
                workbench.dirty &&
                !window.confirm(
                  "当前模型的配置尚未保存，仍要打开另一个模型吗？",
                )
              )
                return;
              workbench.accept(
                settings ? { ...loaded, settings } : loaded,
                !!settings,
              );
            }}
          />
        )}
        {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      </div>
    );

  return (
    <div className="app">
      {navigation}
      <WorkbenchPage workbench={workbench} />
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
