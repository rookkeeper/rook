# Narrow skills and the environment bridge

The product direction is for Rook to interact with environments through narrow, reviewable capabilities rather than handing every agent direct access to every platform.

A future environment bridge may expose a semantic operation such as:

```text
interact_with_environment("mac:md.obsidian/MyVault", "POST", "new_reading_item", {...})
```

The skill would describe the operation; a bridge would translate it into the platform-specific action. A Mac bridge might use Accessibility/AppleScript, a web bridge might use authenticated HTTP, and an IoT bridge might use a device API.

This lets one Rook session understand that an environment exists without assuming that the current client can execute that environment's native operations. It also gives the product a place to enforce authentication, permissions, and audit behavior.

## Current boundary

The current migration does not implement a universal bridge tool. Skills are loaded as files, the Mac bridge remains a separate client/server capability, and repository content is approved at bundle granularity. MCP configuration is stored and exposed for review, but MCP startup, tool enumeration, authentication, and lifecycle are deferred.

## Future requirements

A complete bridge must define an allowlisted operation vocabulary, environment and session scoping, authentication/token ownership, user confirmation for mutating operations, structured errors, audit events, and capability-specific approval/sandbox behavior.
