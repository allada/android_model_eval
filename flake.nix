{
  description = "Development shell for eval_model";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forEachSystem = f:
        builtins.listToAttrs (map (system: {
          name = system;
          value = f system;
        }) supportedSystems);
    in {
      devShells = forEachSystem (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
            config.android_sdk.accept_license = true;
          };
        in {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.nodePackages.npm
              pkgs.androidenv.androidPkgs.platform-tools
            ];
          };
        });
    };
}
