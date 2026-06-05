I bet we need to make several tests. Take not of our patterns elsewhere (tell me if there's anything unexpected - shouldn't be) and make tests that reasonably cover the high-level functionality (not the nit-picky stuff that might change anyway)

Remove the ability for the parent window to push skils to the agent. Everything should move into the SesstionRoom based upon it's interaction with the EnvironmentManager

Why does the sessionroom (or something) have to poll for the existence of available environments. I would think that onEnvironmentEntered would send those updates immediately

this is really close - but right now the wikipedia environment is injected immediately - that shouldn't happen

It makes sense for the environment approval modal to be shown to every client for which a session room room that gets this environment available. available. But when that environment is approved in any of the clients or denied, then the modal and all the other open screens should be closed. How can we do this without shaking stuff up too much? 