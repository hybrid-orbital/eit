{
  description = "EIT Lab — browser-based finite-element simulation playground";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
      eachSystem = nixpkgs.lib.genAttrs systems;
    in {
      devShells = eachSystem (system: let pkgs = import nixpkgs { inherit system; }; in {
        default = pkgs.mkShellNoCC {
          packages = [ pkgs.nodejs_22 ];
          shellHook = ''echo "EIT Lab · npm ci · npm run dev"'';
        };
      });
    };
}
