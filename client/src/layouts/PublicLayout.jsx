import { Outlet } from "react-router-dom";

// Gives every public page (welcome, logins, register) the background picture
export default function PublicLayout() {
  return (
    <div className="public-bg">
      <Outlet />
    </div>
  );
}