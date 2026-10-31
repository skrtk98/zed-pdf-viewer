use serde::Deserialize;
use zed_extension_api::settings::ContextServerSettings;
use zed_extension_api::{
    self as zed, serde_json, Command, ContextServerConfiguration, ContextServerId, Project, Result,
};

const DEFAULT_COMMAND: &str = "mupdf-viewer";

const SETTINGS_SCHEMA: &str = r#"{
  "type": "object",
  "properties": {
    "command": { "type": "string", "description": "Path of the mupdf-viewer executable, or of node when args is set" },
    "args": { "type": "array", "items": { "type": "string" }, "description": "Arguments placed before \"mcp\", such as the path of dist/cli.js" }
  },
  "additionalProperties": false
}"#;

const DEFAULT_SETTINGS: &str = r#"{
  "command": "mupdf-viewer",
  "args": []
}"#;

const INSTALLATION_INSTRUCTIONS: &str = "Build and link the viewer first: run `npm ci && npm run build && npm link` in the `viewer` directory of this repository.\n\nIf Zed cannot find `mupdf-viewer` or `node` on its PATH, set `command` to the absolute path of `node` and `args` to the absolute path of `viewer/dist/cli.js`.";

#[derive(Default, Deserialize)]
#[serde(default)]
struct ViewerSettings {
    command: Option<String>,
    args: Vec<String>,
}

struct MupdfViewerExtension;

impl zed::Extension for MupdfViewerExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        context_server_id: &ContextServerId,
        project: &Project,
    ) -> Result<Command> {
        let settings = ContextServerSettings::for_project(context_server_id.as_ref(), project)?;
        let settings: ViewerSettings = match settings.settings {
            Some(value) => serde_json::from_value(value).map_err(|err| err.to_string())?,
            None => ViewerSettings::default(),
        };
        let mut args = settings.args;
        args.push("mcp".to_string());
        Ok(Command {
            command: settings
                .command
                .unwrap_or_else(|| DEFAULT_COMMAND.to_string()),
            args,
            env: Vec::new(),
        })
    }

    fn context_server_configuration(
        &mut self,
        _context_server_id: &ContextServerId,
        _project: &Project,
    ) -> Result<Option<ContextServerConfiguration>> {
        Ok(Some(ContextServerConfiguration {
            installation_instructions: INSTALLATION_INSTRUCTIONS.to_string(),
            settings_schema: SETTINGS_SCHEMA.to_string(),
            default_settings: DEFAULT_SETTINGS.to_string(),
        }))
    }
}

zed::register_extension!(MupdfViewerExtension);
