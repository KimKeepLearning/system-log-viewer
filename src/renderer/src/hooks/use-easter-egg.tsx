import { useNavigate } from "@tanstack/react-router";

export const useEasterEgg = () => {
  const navigate = useNavigate();
  const handleLogoClick = () => {
    navigate({ to: "/home" });
  };

  return { handleLogoClick };
};
