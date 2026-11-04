import { BrowserRouter, Route, Routes } from "react-router-dom";
import { StoreProvider } from "./lib/store";
import { PortalLayout } from "./layouts/Layout";
import { Login, Register, Welcome } from "./pages/Public";
import { BookAppointment, CustomerDashboard, ManageVehicles, ServiceHistory } from "./pages/Customer";
import { AdminAppointments, AdminCustomers, AdminDashboard, AdminServices } from "./pages/Admin";

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/customer-login" element={<Login role="customer" />} />
          <Route path="/admin-login" element={<Login role="admin" />} />
          <Route path="/register" element={<Register />} />

          <Route path="/customer" element={<PortalLayout role="customer" />}>
            <Route index element={<CustomerDashboard />} />
            <Route path="vehicles" element={<ManageVehicles />} />
            <Route path="book" element={<BookAppointment />} />
            <Route path="history" element={<ServiceHistory />} />
          </Route>

          <Route path="/admin" element={<PortalLayout role="admin" />}>
            <Route index element={<AdminDashboard />} />
            <Route path="appointments" element={<AdminAppointments />} />
            <Route path="customers" element={<AdminCustomers />} />
            <Route path="services" element={<AdminServices />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}
